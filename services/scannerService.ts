import { GoogleGenAI, Type } from "@google/genai";
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { computeDHash, base64ToBuffer, bufferToPostgresBytea } from '@/lib/phash';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { GameId } from '@/lib/games';
import { Card } from '../types';

// The games the catalog holds (pokemon_cards.game). Mirrors lib/games.ts GAMES — used
// to constrain the model's game detection and to game-scope catalog lookups so a number
// printed on, say, an MTG card can't false-match a Pokémon row with the same number.
const SCAN_GAME_IDS: GameId[] = ['pokemon', 'mtg', 'yugioh', 'onepiece', 'riftbound', 'lorcana'];
function sanitizeGame(v: any): GameId | null {
  return typeof v === 'string' && (SCAN_GAME_IDS as string[]).includes(v) ? (v as GameId) : null;
}

// The catalog stores Japanese as `language='ja'`; the scan pipeline, the client's
// `languageHint` and the rest of the UI all use `'jp'`. EVERY catalog query below must
// go through this — an unmapped 'jp' matches zero rows (all ~24k Japanese cards are
// 'ja'), which silently sank tiers 1/1b/1c and the language-filtered pHash tier for
// every Japanese card and left the unfiltered sweep as the only survivor.
//
// Unlike lib/catalogFields.ts:dbLanguage, null/unknown is preserved as null rather than
// defaulting to 'en': here a missing language means "don't filter", not "English".
function catalogLanguage(lang: string | null | undefined): string | null {
  if (!lang || lang === 'other') return null;
  return lang === 'jp' ? 'ja' : lang;
}

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

// Sanity ceiling for the deterministic (set code + number) lookup. That tier is normally
// ground truth, but Flash occasionally OCRs a set code into a *different valid* code (the
// documented Thai "8s" -> "bs"/"B5" failure), which would silently return the wrong card at
// high confidence with no image check. A correct card photographed under glare/angle still
// lands well under this against its catalog scan (~40% of 64 bits); only a grossly different
// image exceeds it. On a breach we fall through to the (language, number) tier — both fields
// are ~100% reliable in diagnostics — so the redundant pipeline self-corrects.
const SET_CODE_PHASH_SANITY = 26;

export interface ScanResultPrimary {
  name: string;
  set: string;
  setHint?: string;
  number: string;
  rarity: string;
  language?: 'en' | 'th' | 'jp' | 'other';
  // Detected trading-card game. Drives which catalog slice the client searches on the
  // LLM-fallback path; the pHash path already returns fully-mapped Cards carrying `game`.
  game?: GameId;
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
  source?: 'set-code-ocr' | 'phash' | 'gemini-text' | 'gemini-image';
  // scan_events row id. Clients POST it to /api/scan/feedback with the user's
  // confirm/reject outcome — confirmed photos feed the learned-phash index.
  scanId?: string;
}

export interface ScanPayload {
  image?: string;
  text?: string;
  languageHint?: 'en' | 'jp' | 'th' | 'other';
  // Optional game hint from the UI. The scan entry is game-agnostic today (the user
  // scans any card), so this is usually absent and the game is auto-detected. When a
  // future game-scoped scan flow passes it, it narrows lookups + the pHash search.
  gameHint?: GameId;
  // 'live' = one frame of a continuous auto-capture loop: cheap tiers only (pHash +
  // deterministic OCR lookups), a miss returns an empty result for the next frame to
  // retry. 'single' (default) = a deliberate one-shot capture: full pipeline incl.
  // the Gemini image fallback. Keeps auto-loops from paying full-pipeline cost on
  // every miss — the failure mode that exhausted the SerpApi plan in 2026-07.
  mode?: 'live' | 'single';
}

// Per-scan diagnostics accumulated across the pipeline for scan_events logging.
interface ScanDiag {
  hashHex?: string;
  ocr?: {
    game: GameId | null;
    name: string | null;
    setCode: string | null;
    cardNumber: string | null;
    language: string | null;
    confidence?: number;
  };
}

// Retry a Gemini call once on retryable failures (rate limit, transient 5xx,
// network). A 429 means "wait a moment", not "give up" — before this existed,
// transient Gemini failures cascaded into the paid Google Lens fallback.
async function geminiWithRetry<T>(label: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = typeof e?.status === 'number' ? e.status : undefined;
    const retryable =
      status === 429 ||
      (status !== undefined && status >= 500) ||
      /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|fetch failed|ECONNRESET|timed? ?out/i.test(msg);
    if (!retryable) throw e;
    console.warn(`[ScannerService] ${label} retryable failure, retrying once:`, msg);
    await new Promise((r) => setTimeout(r, 800));
    return call();
  }
}

export const scannerService = {
  async scanCard(payload: ScanPayload): Promise<ScanResult> {
    const ai = getAi();
    const hasGemini = !!ai;
    const hasImage = !!payload.image;
    const hasText = !!payload.text;
    const mode: 'live' | 'single' = payload.mode === 'live' ? 'live' : 'single';
    const scanId = randomUUID();
    const startedAt = Date.now();
    const diag: ScanDiag = {};

    // Every exit funnels through here so scan_events gets exactly one row per scan.
    // Logging is best-effort — a telemetry hiccup must never fail a scan.
    const finish = async (result: ScanResult | null, error?: string): Promise<ScanResult> => {
      await this.logScanEvent({
        scanId,
        mode,
        diag,
        result,
        error: error ?? null,
        latencyMs: Date.now() - startedAt,
      });
      if (result) return { ...result, scanId };
      if (mode === 'live') {
        // A live-frame miss is expected — the client's next frame retries. Return an
        // empty result instead of throwing so the loop stays cheap and quiet.
        return { primary: null, candidates: [], matches: [], scanId };
      }
      throw new Error(error || 'All scan paths failed. Try a sharper, well-lit image.');
    };

    // 1) pHash path — runs whenever an image is present. Far cheaper and more accurate
    // than any LLM call when the card has been backfilled into the catalog. Includes
    // the deterministic set-code/number tiers and the learned photo-hash index.
    if (hasImage) {
      try {
        const phashResult = await this.phashScan(payload.image as string, {
          ocrText: payload.text,
          userLocale: payload.languageHint,
          gameHint: payload.gameHint,
          diag,
        });
        if (phashResult && phashResult.matches && phashResult.matches.length > 0) {
          const bestDist = phashResult.matchDistance ?? 99;
          if (bestDist <= DIST_CANDIDATE_CEILING) return finish(phashResult);
          console.log(`[ScannerService] pHash best distance ${bestDist} > ceiling, falling through`);
        }
      } catch (e) {
        console.warn('[ScannerService] pHash path failed:', e);
      }
    }

    // Live frames stop here: no LLM fallbacks on a continuous loop. The next frame
    // (or the client's single-shot escalation) picks it up.
    if (mode === 'live') {
      return finish(null, hasImage ? undefined : 'Image payload missing.');
    }

    // 2) Native OCR text path — when the device produced clean OCR text, parse with Flash.
    if (hasText && hasGemini) {
      try {
        console.log('[ScannerService] Engaging Native OCR Flow via Gemini Flash...');
        const r = await this.geminiTextScan(payload.text as string);
        return finish({ ...r, source: 'gemini-text' });
      } catch (e) {
        console.warn('[ScannerService] Native Text Parse failed, falling back to Image evaluation...', e);
      }
    }

    if (!hasImage) {
      if (!hasGemini) {
        return finish(null, 'No scanning paths available. Configure GEMINI_API_KEY.');
      }
      return finish(null, 'Image payload missing and Native Text failed.');
    }

    // 3) Final fallback: vision LLM (Flash, not Pro — speed matters when pHash has
    // already missed). The old Google Lens / SerpApi tier below this was removed
    // 2026-07-10: it only fired when Gemini threw, yet needed Gemini itself to parse
    // the Lens titles — so it consumed a paid search precisely when it couldn't
    // succeed, and exhausted the 5k/mo plan. geminiWithRetry now absorbs the
    // transient failures that used to cascade there.
    if (hasGemini) {
      try {
        console.log('[ScannerService] Engaging Gemini Flash (image fallback)...');
        const r = await this.geminiScan(payload.image as string, 'gemini-2.5-flash');
        return finish({ ...r, source: 'gemini-image' });
      } catch (e) {
        console.warn('[ScannerService] Gemini Flash failed:', e);
      }
    }

    return finish(null, 'All scan paths failed. Try a sharper, well-lit image.');
  },

  // Best-effort insert into scan_events. Fails soft in every direction: table not
  // yet migrated, DB hiccup, oversized fields — none of it may break a scan.
  async logScanEvent(entry: {
    scanId: string;
    mode: 'live' | 'single';
    diag: ScanDiag;
    result: ScanResult | null;
    error: string | null;
    latencyMs: number;
  }): Promise<void> {
    try {
      const supabase = getSupabase();
      const matches = entry.result?.matches ?? [];
      const { error } = await supabase.from('scan_events').insert({
        id: entry.scanId,
        mode: entry.mode,
        source: entry.result?.source ?? null,
        phash: entry.diag.hashHex ?? null,
        ocr: entry.diag.ocr ?? null,
        matched_card_id: matches[0]?.id ?? null,
        candidate_ids: matches.length > 0 ? matches.slice(0, 10).map((m) => m.id) : null,
        match_distance: entry.result?.matchDistance ?? null,
        latency_ms: entry.latencyMs,
        error: entry.error ? entry.error.slice(0, 500) : null,
      });
      if (error) console.warn('[ScannerService] scan_events insert failed (non-fatal):', error.message);
    } catch (e) {
      console.warn('[ScannerService] scan_events insert failed (non-fatal):', e);
    }
  },

  async phashScan(
    base64Image: string,
    opts: { ocrText?: string; userLocale?: string; gameHint?: GameId; diag?: ScanDiag } = {}
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

    if (opts.diag) {
      opts.diag.hashHex = hex;
      if (ocr) {
        opts.diag.ocr = {
          game: ocr.game ?? null,
          name: ocr.name ?? null,
          setCode: ocr.setCode,
          cardNumber: ocr.cardNumber,
          language: ocr.language,
          confidence: ocr.confidence,
        };
      }
    }

    // Detected game (or the UI's hint). Scopes every catalog lookup below to one game so
    // a number/name printed on one game's card can't false-match another game's row.
    // pHash is the cross-game guarantee (artworks are globally unique), so when the game
    // is wrong or unknown the redundant tiers still self-correct.
    const detectedGame: GameId | null = ocr?.game ?? opts.gameHint ?? null;

    // -------- Tier 1: deterministic (set_id, number) lookup --------
    if (ocr?.setCode && ocr?.cardNumber) {
      const direct = await this.lookupBySetAndNumber(ocr.setCode, ocr.cardNumber, ocr.language, detectedGame);
      if (direct && direct.length > 0) {
        // Multiple matches happen for variant prints (holo/reverse holo/full-art at the
        // same number). Rank them by dHash distance so the user's actual print surfaces.
        const ranked = await this.rankByPhash(direct, hex);
        // Verify the best print actually resembles the captured frame before trusting the
        // set code as ground truth — a misread set code lands on a real-but-wrong card here.
        // Rows already carry `phash` (select '*'), so this is free. No stored phash (some ja
        // rows) -> unverifiable -> trust the deterministic lookup as before.
        const verify = rowPhashDistance(ranked[0].phash, hex);
        if (verify === null || verify <= SET_CODE_PHASH_SANITY) {
          return this.buildScanResult(ranked, ranked[0].distance ?? 0, 'set-code-ocr');
        }
        console.log(
          `[ScannerService] set-code lookup hash distance ${verify} > ${SET_CODE_PHASH_SANITY}; set code likely misread, falling through to language+number`,
        );
      }
    }

    // -------- Tier 1b: name + language lookup when set code was unreadable --------
    // The model reads the Pokémon name correctly even when the set code is obscured
    // (glare, fingerprint, oblique angle). Cross-checking name + number + language
    // narrows the catalog to a handful of candidates; pHash picks the right one.
    if (ocr?.name && ocr?.language && (ocr?.cardNumber || ocr?.setCode)) {
      const byName = await this.lookupByNameAndLanguage(ocr.name, ocr.language, ocr.cardNumber, detectedGame);
      if (byName && byName.length > 0) {
        const ranked = await this.rankByPhash(byName, hex);
        if ((ranked[0].distance ?? 99) <= 14) {
          return this.buildScanResult(ranked, ranked[0].distance ?? 0, 'set-code-ocr');
        }
      }
    }

    // -------- Tier 1c: language + number lookup ----------------------------------
    // When the model gets BOTH the language and the card number right but the set
    // code or Pokémon name fails (common failure mode — diagnostics on Thai cards
    // show 100% language and 100% number accuracy even when set OCR misreads "8s"
    // as "bs"/"B5"), the (language, number) pair narrows the catalog to typically
    // 1-10 cards across all sets, and pHash picks the right one from there.
    if (ocr?.language && ocr?.cardNumber) {
      const byLangNum = await this.lookupByLanguageAndNumber(ocr.language, ocr.cardNumber, detectedGame);
      if (byLangNum && byLangNum.length > 0) {
        const ranked = await this.rankByPhash(byLangNum, hex);
        if ((ranked[0].distance ?? 99) <= 18) {
          return this.buildScanResult(ranked, ranked[0].distance ?? 0, 'set-code-ocr');
        }
      }
    }

    // -------- Tier 2: pHash search, filtered by detected language + game --------
    // Cross-game artworks never collide, so the game filter is a precision/speed
    // optimisation, not a correctness requirement — we fall back fully unfiltered below.
    // Runs in parallel with the learned photo-hash index (user-confirmed scans of real
    // photos), whose matches are merged into the candidate pool below — a photo of a
    // card matches previous photos of it far better than it matches catalog art.
    const langFilter = catalogLanguage(ocr?.language);

    const runRpc = (lang: string | null, game: string | null) =>
      supabase.rpc('search_pokemon_by_phash', {
        query_phash: hex,
        max_distance: DIST_CANDIDATE_CEILING,
        result_limit: 10,
        language_filter: lang,
        game_filter: game,
      });

    const [catalogRes, learnedRes] = await Promise.all([
      runRpc(langFilter, detectedGame),
      supabase.rpc('search_learned_phash', {
        query_phash: hex,
        max_distance: DIST_CANDIDATE_CEILING,
        result_limit: 5,
      }),
    ]);
    // The learned index fails soft: before its migration runs (or on any error) we
    // just proceed catalog-only.
    const learned: Array<{ card_id: string; distance: number }> = learnedRes.error
      ? []
      : (learnedRes.data ?? []);

    let rows = catalogRes.data;
    if (catalogRes.error) {
      console.error('[ScannerService] phash RPC error:', catalogRes.error);
      if (learned.length === 0) return null;
      rows = [];
    }

    // If the detected language/game returned nothing, the detection may have been wrong
    // (e.g. partial OCR, misjudged game). Retry fully unfiltered across the whole catalog.
    if ((langFilter || detectedGame) && (!rows || rows.length === 0) && learned.length === 0) {
      console.log(`[ScannerService] phash: 0 matches in lang=${langFilter} game=${detectedGame}, retrying unfiltered`);
      const retry = await runRpc(null, null);
      if (retry.error) {
        console.error('[ScannerService] phash retry error:', retry.error);
        return null;
      }
      rows = retry.data;
    }

    // Merge learned matches into the candidate pool: hydrate ids the catalog search
    // didn't already surface, then keep the minimum distance per card.
    if (learned.length > 0) {
      const have = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));
      const missingIds = learned.filter((l) => !have.has(l.card_id)).map((l) => l.card_id);
      if (missingIds.length > 0) {
        const { data: learnedCards, error: hydrateErr } = await supabase
          .from('pokemon_cards')
          .select('id, name, english_name, set_id, number, rarity, supertype, image_small, image_large, language, game, raw_data')
          .in('id', missingIds);
        if (!hydrateErr && learnedCards) {
          const distById = new Map(learned.map((l) => [l.card_id, l.distance]));
          for (const c of learnedCards) {
            have.set(c.id, { ...c, distance: distById.get(c.id) ?? 99 });
          }
        }
      }
      for (const l of learned) {
        const row = have.get(l.card_id);
        if (row && l.distance < row.distance) row.distance = l.distance;
      }
      rows = Array.from(have.values());
      console.log(`[ScannerService] learned-phash contributed ${learned.length} match(es), best distance ${learned[0].distance}`);
    }

    if (!rows || rows.length === 0) return null;

    // Re-rank: when two prints tie on distance, prefer the user's app-locale region.
    // Purely cosmetic ordering — the candidate list already spans languages when
    // distances are spread, and the user sees the language chip in the UI.
    const ranked = [...rows].sort((a: any, b: any) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      // Row language is the DB code ('ja'); userLocale is the UI code ('jp'). Normalize
      // before comparing or the tiebreaker silently never fires for Japanese collectors.
      const locale = catalogLanguage(opts.userLocale);
      if (locale) {
        const al = a.language === locale ? 0 : 1;
        const bl = b.language === locale ? 0 : 1;
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
    game?: GameId | null,
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

    const numberOr = `number.eq.${numeratorRaw},number.eq.${numeratorStripped},number.ilike.${numeratorRaw}/%,number.ilike.${numeratorStripped}/%`;
    const select = '*, market_values(condition, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';

    // Set-id matching, in order of decreasing precision. For Pokémon the printed code IS
    // the set_id ("MA3", "swsh3"); other games prefix it ("mtg-big", "ygo-bach"), so the
    // trailing suffix leg lets a printed "BIG"/"BACH" reach the namespaced row. game + number
    // + the caller's pHash sanity gate keep the looser legs from returning a wrong card.
    const setMatchers: Array<(q: any) => any> = [
      (q) => q.ilike('set_id', cleanSet),
      (q) => q.ilike('set_id', `${cleanSet}%`),
      (q) => q.ilike('set_id', `%${cleanSet}`),
    ];

    for (const applySetMatcher of setMatchers) {
      let q = applySetMatcher(supabase.from('pokemon_cards').select(select)).or(numberOr);
      const dbLang = catalogLanguage(language);
      if (dbLang) q = q.eq('language', dbLang);
      if (game) q = q.eq('game', game);
      const { data, error } = await q.limit(5);
      if (error) {
        console.warn('[ScannerService] lookupBySetAndNumber error:', error);
        return null;
      }
      if (data && data.length > 0) return data;
    }
    return null;
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
    game?: GameId | null,
  ): Promise<any[] | null> {
    const supabase = getSupabase();
    const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    if (!cleanName) return null;

    let q = supabase
      .from('pokemon_cards')
      .select('*, market_values(condition, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)')
      .or(`name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`)
      .eq('language', catalogLanguage(language) ?? language);
    if (game) q = q.eq('game', game);

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

  // Final lookup tier — language + card number alone is a powerful filter even when
  // both the set code and the Pokémon name OCR failed. The model's diagnostics on
  // Thai cards showed 100% language and 100% number accuracy across 10 random samples,
  // so this tier acts as a safety net: 6-7k Thai-language rows narrowed by a 3-digit
  // number is a handful of candidates, and pHash distance picks the right one.
  async lookupByLanguageAndNumber(
    language: 'en' | 'th' | 'jp',
    cardNumber: string,
    game?: GameId | null,
  ): Promise<any[] | null> {
    const supabase = getSupabase();
    const numerator = cardNumber.split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!numerator) return null;
    const stripped = numerator.replace(/^0+/, '') || numerator;

    let q = supabase
      .from('pokemon_cards')
      .select('*, market_values(condition, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)')
      .eq('language', catalogLanguage(language) ?? language)
      .or(
        `number.eq.${numerator},number.eq.${stripped},number.ilike.${numerator}/%,number.ilike.${stripped}/%`,
      );
    if (game) q = q.eq('game', game);
    const { data, error } = await q.limit(20);
    if (error) {
      console.warn('[ScannerService] lookupByLanguageAndNumber error:', error);
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
      supabase.from('market_values').select('card_id, condition, market_avg, currency, last_updated').in('card_id', ids),
      supabase.from('pokemon_sets').select('id, name, printed_total, total')
        .in('id', Array.from(new Set(rows.map((r) => r.set_id).filter(Boolean)))),
    ]);
    // Keep ALL condition rows per card; the card mapper picks the ungraded
    // display row (cards can carry graded "PSA 10"-style rows since the
    // PriceCharting ingest, and those must never become the shown price).
    const marketBy = new Map<string, any[]>();
    for (const m of marketRes.data ?? []) {
      const list = marketBy.get(m.card_id) ?? [];
      list.push(m);
      marketBy.set(m.card_id, list);
    }
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
      game: (top.game as GameId) || 'pokemon',
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

  // Full-card identification using Gemini 2.5 Flash. Multi-image input: the full
  // card plus a bottom-strip crop so the model has both the artwork context AND a
  // high-resolution view of the printed set code / card number.
  //
  // Why Flash and not Pro: diagnostic on 10 random Thai cards showed Flash hits 10/10
  // on language detection, 10/10 on card number, 5/10 on set code OCR, with zero
  // truncations. Pro hit 4/10 with 3 truncations — its mandatory thinking tokens
  // eat into the output budget on multi-field structured responses, occasionally
  // producing degenerate 30 KB strings or partial JSON. Flash is also 2-3× faster
  // (~4-8s vs ~6-13s) and ~30× cheaper. The set-OCR shortfall doesn't matter because
  // tier 1c (language + number → pHash among <20 candidates) catches every Thai card
  // where the first two fields parsed correctly.
  //
  // Cost: ~$0.0003/scan. Latency: 4-8s typical.
  //
  // Free-of-charge fast path: if the device already sent us native MLKit OCR text and
  // a quick regex parse extracts everything we need, we skip the Flash call.
  async extractCardMetadata(
    base64Image: string,
    ocrText?: string,
  ): Promise<{
    setCode: string | null;
    cardNumber: string | null;
    language: 'en' | 'th' | 'jp' | null;
    name?: string | null;
    rarity?: string | null;
    // Detected game. Only the LLM path can read it; the OCR-text-only fast path leaves it
    // undefined (so callers treat the game as unknown and search cross-game).
    game?: GameId | null;
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
      const response = await geminiWithRetry('Flash extraction', () => ai.models.generateContent({
        // Flash (not Pro). Diagnostic on 10 random Thai cards: Flash hit 10/10 on
        // language, 10/10 on card number, 5/10 on set code (the misses are OCR
        // confusion of "8s" with "bs"/"B5" — handled by tier 1c which uses the
        // 100%-reliable (language, number) pair as the filter). Pro hit 4/10 with
        // 3 truncations because its thinking tokens eat into the output budget
        // on multi-field structured responses. Flash is also 2-3× faster.
        model: 'gemini-2.5-flash',
        contents: [
          {
            parts: [
              { inlineData: { data: fullBase64, mimeType: 'image/jpeg' } },
              { inlineData: { data: bottomBase64, mimeType: 'image/jpeg' } },
              {
                text: `You are a trading-card identification expert. The card belongs to ONE of these games: Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, One Piece Card Game, Riftbound, or Disney Lorcana. Two images are provided: the full card, then a magnified view of its bottom edge.

Extract the following fields. Be concise — values are short strings, not paragraphs.

- game: Which game it is. One of exactly: "pokemon", "mtg", "yugioh", "onepiece", "riftbound", "lorcana". Cues: Pokémon (energy symbols, HP top-right, "ex"/"V"/"VMAX"); Magic (mana cost circles top-right, a card-type line, a set symbol mid-right); Yu-Gi-Oh (orange/blue header, ATK/DEF bottom-right, a passcode bottom-left); One Piece (DON!!/power top-left, life/cost circles); Riftbound (League of Legends champions/runes); Lorcana (Disney characters, ink cost gems top-left, lore/strength/willpower). If unsure, give your best guess.
- name: The card's name in English (canonical). Even on Thai or Japanese cards, return the standard English name (e.g. "Charizard ex", "Black Lotus", "Blue-Eyes White Dragon").
- setCode: The short alphanumeric set/expansion code printed near the bottom corners. Examples by game — Pokémon: "MA3", "SV5K", "swsh3", "s12a", "PROMO"; Magic: "BLB", "MH3"; Yu-Gi-Oh: "LOB", "BACH" (often as a prefix in the card number like "BACH-EN001"); One Piece: "OP01", "EB01"; Riftbound: "OGN"; Lorcana: the set number. Maximum 10 characters. Preserve exact casing. Strip any trailing region marker like " T" (Thai) or " J" (Japanese). If unreadable, return null.
- cardNumber: The collector number as printed, usually digits, sometimes with a forward slash or a set prefix. Examples: "087/198", "132/190", "0123", "BACH-EN001", "OP01-003", "007/298". Maximum 14 characters. If unreadable, return null.
- language: How to decide — this is critical, do it carefully:
    Step 1: Look at the BODY TEXT (the rules/attack/effect box in the middle of the card).
    Step 2: Is ANY non-Latin script visible there? Thai characters (e.g. ก ข ค ง จ ฉ พ ม ภ ภาษาไทย) or Japanese hiragana/katakana/kanji (e.g. の は を します ポケモン)?
    Step 3: If you see Thai script anywhere → "th". If you see hiragana/katakana/kanji → "ja". If only Latin/English → "en".
    Important: card NAMES are often shown in English even on regional prints (a Thai card may still show "Charizard ex" in Latin). What matters is the BODY TEXT. Do NOT decide based on the card name or set code alone.
- rarity: Best guess for that game (e.g. "C", "U", "R", "RR", "SR", "AR", "SAR", "UR", "Mythic", "Secret", "Legendary"...). If unclear, null.
- confidence: Overall 0.0 to 1.0.

Return JSON only. Keep values terse — single short string per field.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              game: { type: Type.STRING, enum: SCAN_GAME_IDS as string[] },
              name: { type: Type.STRING },
              setCode: { type: Type.STRING },
              cardNumber: { type: Type.STRING },
              language: { type: Type.STRING, enum: ['en', 'th', 'ja'] },
              rarity: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
          },
        },
      }));
      const parsed = JSON.parse(response.text || '{}');
      // Sanity-check field shapes — Pro occasionally hallucinates ultra-long strings
      // when it gets confused. Drop anything outside the expected envelope.
      const sanitizeCode = (v: any): string | null => {
        if (typeof v !== 'string') return null;
        const trimmed = v.trim();
        if (trimmed.length === 0 || trimmed.length > 12) return null;
        return trimmed;
      };
      const sanitizeNumber = (v: any): string | null => {
        if (typeof v !== 'string') return null;
        const trimmed = v.trim();
        // 14 chars covers prefixed numbers like "BACH-EN001" / "OP01-003" alongside "087/198".
        if (trimmed.length === 0 || trimmed.length > 14) return null;
        return trimmed;
      };
      const sanitizeName = (v: any): string | null => {
        if (typeof v !== 'string') return null;
        const trimmed = v.trim();
        if (trimmed.length === 0 || trimmed.length > 60) return null;
        return trimmed;
      };
      const language =
        parsed.language === 'ja' ? 'jp' : parsed.language === 'th' || parsed.language === 'en' ? parsed.language : null;
      const cleanSetCode = sanitizeCode(parsed.setCode);
      const cleanCardNumber = sanitizeNumber(parsed.cardNumber);
      const cleanName = sanitizeName(parsed.name);
      const cleanGame = sanitizeGame(parsed.game);
      console.log('[ScannerService] Flash extraction:', {
        game: cleanGame,
        name: cleanName,
        setCode: cleanSetCode,
        cardNumber: cleanCardNumber,
        language,
        confidence: parsed.confidence,
      });
      return {
        setCode: cleanSetCode || fromOcrText?.setCode || null,
        cardNumber: cleanCardNumber || fromOcrText?.cardNumber || null,
        language: language ?? fromOcrText?.language ?? null,
        name: cleanName ?? null,
        game: cleanGame,
        rarity: parsed.rarity ?? null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      };
    } catch (e) {
      console.warn('[ScannerService] Pro extraction failed:', e);
      return fromOcrText;
    }
  },

  async geminiScan(base64Image: string, modelName: string = 'gemini-2.5-flash'): Promise<ScanResult> {
    const ai = getAi();
    if (!ai) throw new Error("Gemini API key not configured");

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const response = await geminiWithRetry('Flash image scan', () => ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
            {
              text: `Act as a professional trading-card grader and identifier. The card is from one of: Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, One Piece Card Game, Riftbound, or Disney Lorcana. Identify this EXACT card variation from the cropped image.

CRITICAL INSTRUCTIONS:
1. game: state which game it is — one of "pokemon", "mtg", "yugioh", "onepiece", "riftbound", "lorcana".
2. Examine the bottom corners. Accurately extract the alphanumeric Set Code (e.g. "SV4a", "PROMO", "BLB", "OP01", "LOB") and the Card Number (e.g. "132/190", "0123", "OP01-003", "BACH-EN001").
3. The language will be English, Japanese, or Thai (ภาษาไทย) — judge it from the BODY/rules text, not the name. SET THIS LANGUAGE CORRECTLY!
4. Return the standard ENGLISH card name even when the print is Thai or Japanese.
5. For distinct art variants (Secret/Art rares, alternate arts), make the set code and number reflect this exact print, not the base version.
6. Provide your single best exact match as primary. Return valid JSON.` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: scanResultSchema(),
      }
    }));

    return JSON.parse(response.text || '{}') as ScanResult;
  },

  async geminiTextScan(ocrText: string): Promise<ScanResult> {
    const ai = getAi();
    if (!ai) throw new Error("Gemini API key not configured");

    const response = await geminiWithRetry('Flash text scan', () => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          text: `Act as a professional trading-card grader. The card is from one of: Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, One Piece Card Game, Riftbound, or Disney Lorcana. A mobile device ran Native MLKit OCR on a cropped card and retrieved the following raw text strings:\n\n[ ${ocrText} ]\n\nIdentify the EXACT card variation from this text.
CRITICAL INSTRUCTIONS:
1. game: state which game it is — one of "pokemon", "mtg", "yugioh", "onepiece", "riftbound", "lorcana".
2. Parse the text for the Alphanumeric Set Code (e.g. "SV4a", "PROMO", "BLB", "OP01", "LOB") and the Card Number (e.g. "132/190", "OP01-003", "BACH-EN001").
3. The language will be English, Japanese, or Thai (ภาษาไทย). SET THIS LANGUAGE CORRECTLY!
4. If the text contains Thai or Japanese characters use that to set language, but return the standard ENGLISH card name in the JSON.
5. Provide your single best exact match as primary. Return valid JSON.`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: scanResultSchema(),
      }
    }));

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
                    game: { type: Type.STRING, enum: ['pokemon', 'mtg', 'yugioh', 'onepiece', 'riftbound', 'lorcana'] },
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
// Set codes that carry digits (unambiguous). Pokémon (MA3/SV5K/swsh3/s12a/PROMO) plus the
// digit-bearing codes used by One Piece (OP01/EB01/ST01/PRB01) and Riftbound (OGN). Bare
// 3-letter codes (Magic "BLB", Yu-Gi-Oh "LOB") are intentionally omitted — they'd false-match
// ordinary OCR words; those games fall through to the Flash extractor, which detects the game.
const RE_SET_CODE = /\b(MA[0-9]{1,2}|SV[0-9][a-zA-Z0-9]*|sv[0-9][a-zA-Z0-9]*|swsh[0-9]{1,3}|sm[0-9]{1,3}|s[0-9]{1,3}[a-z]?|PROMO|OP[0-9]{2}|EB[0-9]{2}|ST[0-9]{2}|PRB[0-9]{2}|OGN)\b/;
// "087/198" plus prefixed collector numbers like "OP01-003" / "BACH-EN001".
const RE_CARD_NUMBER = /\b([0-9]{1,3}\/[0-9]{1,3}|[A-Z0-9]{2,5}-[A-Z]{0,3}[0-9]{1,4})\b/;
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

// dHash distance between a candidate row's stored phash and the query hash. Returns null
// when the row has no usable phash (so callers can treat it as "unverifiable" rather than
// "mismatch"). queryHex is the "\\x..."-prefixed bytea string from bufferToPostgresBytea.
function rowPhashDistance(rowPhash: any, queryHex: string): number | null {
    if (typeof rowPhash !== 'string') return null;
    const cardBytes = decodeSupabaseBytea(rowPhash);
    if (!cardBytes) return null;
    return hammingDistance(hexToBytes(queryHex), cardBytes);
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
