import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCHANGE_RATES } from '@/constants';

// Real sealed-product price history from JustTCG (TCGplayer market data).
//
// PriceCharting is the sealed HEADLINE price and stays so, but it has no
// history API and its sealed numbers move rarely, so charting our daily
// snapshots of it drew flat lines. JustTCG indexes sealed products
// (variant condition 'Sealed') with daily TCGplayer market prices and looks
// them up exactly by TCGplayer product id — which our TCGplayer-hosted
// packshot URLs carry. The series is CALIBRATED onto the headline (one scale
// factor per product per merge, see calibrationFactor) so the chart's live
// "Now" point seams into it; the SHAPE is TCGplayer's real day-to-day movement.
//
// scripts/ingest/justtcg-sealed-history.mjs is the bulk (180d) counterpart and
// mirrors these helpers in plain Node — change both together.

export const JUSTTCG_BASE = 'https://api.justtcg.com/v1';
const THB_PER_USD = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// PriceCharting (eBay sold) vs TCGplayer market for the SAME product sit
// within a modest band; a factor outside it means a wrong bridge (or a market
// so different the shape would mislead), so the product is skipped instead.
export const CALIBRATION_MIN = 0.5;
export const CALIBRATION_MAX = 2.0;

export interface JustTcgVariant {
    id?: string;
    condition?: string;
    printing?: string;
    language?: string;
    price?: number;
    priceHistory?: { p: number; t: number }[];
}

export interface JustTcgCard {
    id: string;
    name?: string;
    tcgplayerId?: string | number | null;
    variants?: JustTcgVariant[];
}

export interface SealedPriceRow {
    id: string;
    name?: string | null;
    language: string | null;
    currency: string | null;
    loose_price: number | null;
    cib_price: number | null;
    new_price: number | null;
}

export interface SealedSnapshotRow {
    subject_id: string;
    language: string;
    condition: 'Sealed';
    is_sealed: true;
    market_thb: number;
    market_native: number;
    currency: 'USD';
    source: 'justtcg';
    captured_on: string;
}

/** TCGplayer product id from a product-images.tcgplayer.com packshot URL. */
export function tcgplayerIdFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = /product-images\.tcgplayer\.com\/(?:[^?#]*\/)?(\d+)\.(?:jpe?g|png|webp)/i.exec(url);
    return m ? m[1] : null;
}

/** The 'Sealed' variant to chart: Normal printing, English, richest history. */
export function pickSealedVariant(card: JustTcgCard): JustTcgVariant | null {
    const sealed = (card.variants ?? []).filter((v) => v.condition === 'Sealed');
    if (!sealed.length) return null;
    const score = (v: JustTcgVariant) =>
        (v.printing === 'Normal' ? 100 : 0) +
        (v.language === 'English' ? 10 : 0) +
        Math.min(9, (v.priceHistory?.length ?? 0) / 100);
    return [...sealed].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Second guard behind the calibration band. The TCGplayer id comes from the
 * packshot PriceCharting chose, which is occasionally a RELATED product's image
 * (a "Sleeved Booster Pack Art Bundle [Set of 3]" on a Booster Pack row). A
 * multi-unit or case listing carries a word ours does not; reject those.
 */
const MULTI_UNIT_WORDS = ['case', 'set of', 'lot of', 'bundle', 'sleeved'];
export function sealedNameCompatible(ourName: string | null | undefined, jtName: string | null | undefined): boolean {
    if (!jtName) return true;
    const ours = (ourName ?? '').toLowerCase();
    const theirs = jtName.toLowerCase();
    // "Display" is TCGplayer's word for a Magic booster BOX (36 packs), not a
    // multi-box unit, so a Box row may match a Display listing.
    if (theirs.includes('display') && !ours.includes('display') && !ours.includes('box')) return false;
    return MULTI_UNIT_WORDS.every((w) => !theirs.includes(w) || ours.includes(w));
}

/** Same precedence as mapSealedRowToProduct's headline: sealed, then CIB, then loose. */
export function sealedHeadlineUsd(row: Pick<SealedPriceRow, 'new_price' | 'cib_price' | 'loose_price'>): number | null {
    for (const v of [row.new_price, row.cib_price, row.loose_price]) {
        if (typeof v === 'number' && v > 0) return v;
    }
    return null;
}

/** headline / TCGplayer-now, or null when either side is missing or the ratio is implausible. */
export function calibrationFactor(headlineUsd: number | null, jtNowUsd: number | null | undefined): number | null {
    if (!headlineUsd || !jtNowUsd || jtNowUsd <= 0) return null;
    const f = headlineUsd / jtNowUsd;
    return f >= CALIBRATION_MIN && f <= CALIBRATION_MAX ? f : null;
}

/** Latest price in a variant: its `price`, else the last history point. */
export function variantNowUsd(v: JustTcgVariant): number | null {
    if (typeof v.price === 'number' && v.price > 0) return v.price;
    const h = v.priceHistory ?? [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i]?.p > 0) return h[i].p;
    return null;
}

/**
 * One value per UTC day from the first known day through the last, forward-
 * filled across gaps. Every day is written (not just change points) because
 * the PriceCharting cron already holds a flat row on most of these days: an
 * unwritten gap day would keep that value and saw-tooth against the series.
 */
export function dailyFilled(history: { p: number; t: number }[] | undefined): { day: string; usd: number }[] {
    const byDay = new Map<string, number>();
    for (const p of history ?? []) {
        if (typeof p?.p !== 'number' || p.p <= 0 || typeof p?.t !== 'number') continue;
        byDay.set(new Date(p.t * 1000).toISOString().slice(0, 10), p.p);
    }
    if (!byDay.size) return [];
    const days = [...byDay.keys()].sort();
    const out: { day: string; usd: number }[] = [];
    const lastMs = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
    let held = byDay.get(days[0])!;
    for (let ms = Date.parse(`${days[0]}T00:00:00Z`); ms <= lastMs; ms += 86_400_000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const v = byDay.get(day);
        if (typeof v === 'number') held = v;
        out.push({ day, usd: held });
    }
    return out;
}

/** Calibrated THB rows for price_snapshots. Empty when the series is too short to draw. */
export function sealedHistoryRows(
    row: SealedPriceRow,
    variant: JustTcgVariant,
    factor: number,
): SealedSnapshotRow[] {
    const days = dailyFilled(variant.priceHistory);
    if (days.length < 2) return [];
    return days.map(({ day, usd }) => ({
        subject_id: row.id,
        language: row.language || 'en',
        condition: 'Sealed',
        is_sealed: true,
        market_thb: Math.max(1, Math.round(usd * factor * THB_PER_USD)),
        market_native: usd,
        currency: 'USD',
        source: 'justtcg',
        captured_on: day,
    }));
}

export type JustTcgBatchItem =
    | { cardId: string; include_price_history?: boolean; priceHistoryDuration?: string }
    | { tcgplayerId: string; include_price_history?: boolean; priceHistoryDuration?: string };

/**
 * Batch lookup. History params ride PER ITEM in the body (query-string params
 * are ignored on POST). One retry on 429/5xx; anything else throws.
 */
export async function fetchJustTcgCards(items: JustTcgBatchItem[], apiKey: string): Promise<JustTcgCard[]> {
    if (!items.length) return [];
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${JUSTTCG_BASE}/cards`, {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(items),
            signal: AbortSignal.timeout(45_000),
        });
        if ((res.status === 429 || res.status >= 500) && attempt < 1) {
            await new Promise((r) => setTimeout(r, res.status === 429 ? 6000 : 3000));
            continue;
        }
        if (!res.ok) throw new Error(`JustTCG ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json = (await res.json()) as { data?: JustTcgCard[] };
        return json.data ?? [];
    }
}

interface MergeOptions {
    apiKey: string;
    overBudget: () => boolean;
    /** '7d' for the nightly top-up, '180d' for a backfill. */
    duration?: string;
    /** Unbridged rows to try to bridge per run (new products from the monthly discovery). */
    bridgeLimit?: number;
}

export interface MergeSummary {
    enabled: boolean;
    bridged: number;
    merged: number;
    points: number;
    apiCalls: number;
    skippedCalibration: number;
    errors: string[];
}

/**
 * Nightly leg for /api/cron/price-snapshots: bridge any newly discovered
 * sealed products that carry a TCGplayer packshot, then overwrite the last
 * `duration` of every bridged product's series with calibrated TCGplayer
 * history. Fails soft (enabled=false) until 20260916_sealed_justtcg_bridge.sql
 * adds the columns. Thai rows (currency THB, JP-twin estimates) never bridge.
 */
export async function mergeSealedJustTcgHistory(
    supabase: SupabaseClient,
    { apiKey, overBudget, duration = '7d', bridgeLimit = 150 }: MergeOptions,
): Promise<MergeSummary> {
    const summary: MergeSummary = { enabled: false, bridged: 0, merged: 0, points: 0, apiCalls: 0, skippedCalibration: 0, errors: [] };
    const note = (e: unknown) => {
        if (summary.errors.length < 10) summary.errors.push(e instanceof Error ? e.message : String(e));
    };

    const probe = await supabase.from('sealed_products').select('id, justtcg_id, tcgplayer_id').limit(1);
    if (probe.error) return summary; // columns not migrated yet
    summary.enabled = true;

    // ── Bridge: newest unbridged rows with a TCGplayer id (stored or in the URL) ──
    try {
        const { data: fresh, error } = await supabase
            .from('sealed_products')
            .select('id, name, image_url, tcgplayer_id')
            .is('justtcg_id', null)
            .neq('currency', 'THB')
            .or('tcgplayer_id.not.is.null,image_url.ilike.%product-images.tcgplayer.com%')
            .order('created_at', { ascending: false })
            .limit(bridgeLimit);
        if (error) throw error;
        const byTcg = new Map<string, { id: string; name: string | null }>(); // tcgplayerId -> sealed row
        for (const r of fresh ?? []) {
            const tid = (r.tcgplayer_id as string | null) || tcgplayerIdFromUrl(r.image_url as string | null);
            if (tid && !byTcg.has(tid)) byTcg.set(tid, { id: r.id as string, name: (r.name as string | null) ?? null });
        }
        const ids = [...byTcg.keys()];
        for (let i = 0; i < ids.length && !overBudget(); i += 100) {
            const chunk = ids.slice(i, i + 100);
            const cards = await fetchJustTcgCards(chunk.map((tcgplayerId) => ({ tcgplayerId })), apiKey);
            summary.apiCalls++;
            for (const card of cards) {
                const tid = card.tcgplayerId == null ? null : String(card.tcgplayerId);
                const hit = tid ? byTcg.get(tid) : undefined;
                if (!hit || !pickSealedVariant(card) || !sealedNameCompatible(hit.name, card.name)) continue;
                const { error: upErr } = await supabase
                    .from('sealed_products')
                    .update({ justtcg_id: card.id, tcgplayer_id: tid })
                    .eq('id', hit.id);
                if (upErr) note(upErr.message);
                else summary.bridged++;
            }
        }
    } catch (e) {
        note(e);
    }

    // ── Merge: calibrated history for every bridged product ─────────────────────
    try {
        let cursor = '';
        for (;;) {
            if (overBudget()) break;
            const { data: page, error } = await supabase
                .from('sealed_products')
                .select('id, name, language, currency, loose_price, cib_price, new_price, justtcg_id')
                .not('justtcg_id', 'is', null)
                .neq('currency', 'THB')
                .gt('id', cursor)
                .order('id', { ascending: true })
                .limit(1000);
            if (error) throw error;
            if (!page?.length) break;

            for (let i = 0; i < page.length && !overBudget(); i += 100) {
                const chunk = page.slice(i, i + 100) as (SealedPriceRow & { justtcg_id: string })[];
                const byJt = new Map(chunk.map((r) => [r.justtcg_id, r]));
                let cards: JustTcgCard[];
                try {
                    cards = await fetchJustTcgCards(
                        chunk.map((r) => ({ cardId: r.justtcg_id, include_price_history: true, priceHistoryDuration: duration })),
                        apiKey,
                    );
                } catch (e) {
                    note(e);
                    continue;
                }
                summary.apiCalls++;
                const rows: SealedSnapshotRow[] = [];
                for (const card of cards) {
                    const row = byJt.get(card.id);
                    const variant = row ? pickSealedVariant(card) : null;
                    if (!row || !variant || !sealedNameCompatible(row.name, card.name)) continue;
                    const factor = calibrationFactor(sealedHeadlineUsd(row), variantNowUsd(variant));
                    if (factor == null) {
                        summary.skippedCalibration++;
                        continue;
                    }
                    const built = sealedHistoryRows(row, variant, factor);
                    if (built.length) {
                        rows.push(...built);
                        summary.merged++;
                    }
                }
                for (let j = 0; j < rows.length; j += 500) {
                    const { error: upErr } = await supabase
                        .from('price_snapshots')
                        .upsert(rows.slice(j, j + 500), { onConflict: 'subject_id,language,condition,captured_on' });
                    if (upErr) note(upErr.message);
                    else summary.points += Math.min(500, rows.length - j);
                }
            }
            cursor = page[page.length - 1].id as string;
            if (page.length < 1000) break;
        }
    } catch (e) {
        note(e);
    }

    return summary;
}
